#!/usr/bin/env python3
"""OpenPCR web server — static files + REST API for device control.

Usage:
    python web/serve.py              # serves on http://localhost:8080
    python web/serve.py 8888         # custom port

REST API
--------
GET    /programs                  list all programs
POST   /programs                  create program (body: full JSON program)
GET    /programs/<slug>           get one program
PATCH  /programs/<slug>           update program (body: full JSON program)
DELETE /programs/<slug>           delete program
POST   /run/start                 start run (body: {"programId": "<slug>"})
POST   /run/stop                  stop run
GET    /status                    latest device status

Status shape (running)
  { state, blockTempC, lidTempC, elapsedSec, remainingSec,
    programId, cycleGroupIndex, cycleLoops, cycleIteration,
    stepName, stepHolding, progressInStep }

Status state values: "running" | "stopped" | "complete" | "offline"
"""

import argparse
import glob
import http.server
import json
import os
import re
import subprocess
import secrets
import socket
import sys
import threading
import time
from pathlib import Path

import yaml

# Allow importing openpcrlib from the openpycr submodule.
sys.path.insert(0, str(Path(__file__).parent.parent / 'openpycr'))
from openpcrlib import OpenPCR

DEFAULT_LID_TEMP_C = 110   # used when lid_temperature is absent from a YAML file; must match api.jsx
DEFAULT_BLOCK_TEMP_C = 21  # starting reference for heating/cooling direction; must match api.jsx

_parser = argparse.ArgumentParser(description='OpenPCR web server')
_parser.add_argument('port', nargs='?', type=int, default=8080)
_parser.add_argument('--operator-password', default=None,
                     help='Password required for operator (edit/run) access. '
                          'If omitted, all actions are allowed without login.')
_args = _parser.parse_args()

PORT = _args.port
OPERATOR_PASSWORD = _args.operator_password  # None → no auth required
_sessions: set = set()                       # valid bearer tokens (in-memory)

WEB_DIR = Path(__file__).parent
PROGRAMS_DIR = WEB_DIR / 'programs'
TEMPLATES_DIR = WEB_DIR / 'templates'
PROGRAMS_DIR.mkdir(exist_ok=True)
TEMPLATES_DIR.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _is_operator(handler) -> bool:
    """True if the request carries a valid operator token, or no password is configured."""
    if not OPERATOR_PASSWORD:
        return True
    auth = handler.headers.get('Authorization', '')
    token = auth.removeprefix('Bearer ').strip()
    return token in _sessions


def _require_operator(handler) -> bool:
    """Send 403 and return False when the caller is not an operator."""
    if not _is_operator(handler):
        handler._error(403, 'operator authentication required')
        return False
    return True


# ---------------------------------------------------------------------------
# Slug helpers
# ---------------------------------------------------------------------------

def slugify(text):
    text = (text or '').lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'-+', '-', text).strip('-')
    return text or 'program'


def safe_program_path(slug):
    """Return the resolved YAML path for *slug*, or None if it would escape PROGRAMS_DIR."""
    path = (PROGRAMS_DIR / f'{slug}.yaml').resolve()
    return path if path.is_relative_to(PROGRAMS_DIR.resolve()) else None


def unique_slug(name, directory=None):
    """Return a slug for *name* that has no matching YAML file yet in *directory*."""
    if directory is None:
        directory = PROGRAMS_DIR
    base = slugify(name)
    if not (directory / f'{base}.yaml').exists():
        return base
    i = 1
    while (directory / f'{base}-{i}.yaml').exists():
        i += 1
    return f'{base}-{i}'


# ---------------------------------------------------------------------------
# YAML <-> JSON conversion
# ---------------------------------------------------------------------------

def yaml_to_json(slug, data):
    """Convert a stored YAML dict to the frontend JSON program shape."""
    cycles_raw = data.get('cycles') or []
    cycles = []
    for ci, cycle in enumerate(cycles_raw):
        if 'lid_temperature' in cycle:
            raise ValueError(f"'lid_temperature' in cycle {ci} of '{slug}' — only allowed at program level")
        prev_temp = DEFAULT_BLOCK_TEMP_C
        steps = []
        for si, step in enumerate(cycle.get('steps') or []):
            if 'lid_temperature' in step:
                raise ValueError(
                    f"'lid_temperature' in step '{step.get('name', f's{si}')}' of '{slug}'"
                    " — only allowed at program level"
                )
            if 'temperature' not in step:
                raise ValueError(
                    f"Step '{step.get('name', f's{si}')}' in '{slug}' has no temperature"
                )
            target = float(step['temperature'])
            steps.append({
                'id': f'{slug}-c{ci}-s{si}',
                'name': step.get('name', ''),
                'direction': 'heating' if target >= prev_temp else 'cooling',
                'target': target,
                'duration': int(step.get('duration', 30)),
            })
            prev_temp = target
        cycles.append({
            'id': f'{slug}-c{ci}',
            'loops': int(cycle.get('loops', 1)),
            'steps': steps,
        })
    return {
        'id': slug,
        'name': data.get('pcr_program_name', ''),
        'notes': data.get('pcr_program_description', ''),
        'lid_temperature': int(data.get('lid_temperature', DEFAULT_LID_TEMP_C)),
        'cycles': cycles,
    }


def json_to_yaml_fields(program):
    """Return only the YAML fields derived from a JSON program dict.

    Merge the result into the existing YAML dict (rather than replacing it)
    so that fields not in the JSON model (author, license, version) are kept.
    """
    cycles = []
    for cycle in program.get('cycles') or []:
        steps = []
        for step in cycle.get('steps') or []:
            if 'target' not in step:
                raise ValueError(f"Step '{step.get('name', '?')}' has no target temperature")
            s = {
                'name': step.get('name', ''),
                'temperature': float(step['target']),
                'duration': int(step.get('duration', 30)),
            }
            steps.append(s)
        cycles.append({
            'loops': int(cycle.get('loops', 1)),
            'steps': steps,
        })
    fields = {
        'pcr_program_name': program.get('name', ''),
        'pcr_program_description': program.get('notes', ''),
        'cycles': cycles,
    }
    if 'lid_temperature' in program:
        fields['lid_temperature'] = int(program['lid_temperature'])
    return fields


# ---------------------------------------------------------------------------
# Device string builder
# ---------------------------------------------------------------------------

def program_to_device_string(yaml_data):
    """Build the OpenPCR program string from a stored YAML dict."""
    name = yaml_data.get('pcr_program_name', 'Program')
    lid_temp = int(yaml_data.get('lid_temperature', DEFAULT_LID_TEMP_C))
    parts = []
    for cycle in yaml_data.get('cycles') or []:
        loops = int(cycle.get('loops', 1))
        step_parts = []
        for s in cycle.get('steps') or []:
            if 'temperature' not in s:
                raise ValueError(f"Step '{s.get('name', '?')}' has no temperature")
            temp = int(float(s['temperature']))
            step_parts.append(f"[{int(s.get('duration', 0))}|{temp}|{s.get('name', '')[:10]}]")
        # Single-loop groups are bare top-level steps; only multi-loop groups
        # get the (N[...]) cycle wrapper so the device cycle counter is correct.
        if loops == 1:
            parts.extend(step_parts)
        else:
            parts.append(f'({loops}{"".join(step_parts)})')
    return f"s=ACGTC&c=start&n={name}&l={lid_temp}&p={''.join(parts)}"


# ---------------------------------------------------------------------------
# Device path detection (avoids noisy prints from OpenPCR constructor)
# ---------------------------------------------------------------------------

def _find_device_path():
    """Return the mounted device path if present, else None."""
    platform = sys.platform[:3]
    if platform == 'lin':
        candidates = glob.glob('/media/*/OPENPCR/') + ['/media/OPENPCR/', '/mnt/OPENPCR/']
    elif platform == 'dar':
        candidates = ['/Volumes/OPENPCR/']
    else:
        return None
    return next((p for p in candidates if os.path.exists(p)), None)


# ---------------------------------------------------------------------------
# Run state tracker
# ---------------------------------------------------------------------------

class RunState:
    """Tracks the active run; updated by the device poll thread.

    The c= counter in STATUS.TXT resets to 1 at the start of each cycle
    group.  When a decrease is detected between consecutive polls, the
    group index is advanced.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self.program_id = None
        self._program_json = None   # cached JSON of the running program
        self._group_index = 0
        self._last_cycle_num = None
        self._last_step_name = None
        self._step_started_at = None
        self._device_status = None  # None = not yet polled

    def clear(self):
        with self._lock:
            self.program_id = None
            self._program_json = None
            self._group_index = 0
            self._last_cycle_num = None
            self._last_step_name = None
            self._step_started_at = None

    def start(self, program_id, program_json):
        with self._lock:
            self.program_id = program_id
            self._program_json = program_json
            self._group_index = 0
            self._last_cycle_num = None
            self._last_step_name = None
            self._step_started_at = None  # set when first holding phase begins
            # Optimistically mark device as running so /status responds correctly
            # before the background poll thread reads the device (up to 2 s away).
            self._device_status = dict(self._device_status or {})
            self._device_status['state'] = 'running'

    def update(self, raw):
        """raw is the dict from readstatus(), or None when device is offline."""
        with self._lock:
            self._device_status = raw
            if raw is None or self._program_json is None:
                return
            cycle_num = raw.get('cycle', 1)
            step_name = raw.get('currentstep', '')
            # job: "Heating" / "Cooling" (ramping) or "holding" (at temperature, timer running)
            is_holding = raw.get('job', '').lower() == 'holding'
            cycles = self._program_json.get('cycles', [])

            # Condition A: c= counter decrease → entered the next cycle group.
            if self._last_cycle_num is not None and cycle_num < self._last_cycle_num:
                self._group_index = min(self._group_index + 1, max(0, len(cycles) - 1))

            # Condition B: c= counter exceeds the current group's loop count → advance.
            # Handles 1-loop init groups where the counter resets from 1 to 1,
            # producing no detectable decrease.
            while (self._group_index < len(cycles) - 1
                   and cycle_num > cycles[self._group_index].get('loops', 1)):
                self._group_index += 1

            self._last_cycle_num = cycle_num

            # Condition C: step name is not found in the current group's steps, but
            # is found in a later group → the device has moved past the current group.
            gi = self._group_index
            current_step_names = {s.get('name') for s in cycles[gi].get('steps', [])}
            if step_name and step_name not in current_step_names:
                for i in range(gi + 1, len(cycles)):
                    if step_name in {s.get('name') for s in cycles[i].get('steps', [])}:
                        self._group_index = i
                        self._step_started_at = None  # wait for next holding phase
                        break

            # Condition D: step name exists in both the current and next group (e.g.,
            # an init "Denature" followed by a PCR "Denature").  Use elapsed holding
            # time: if we've held this step name for longer than the current group's
            # step duration, we must have crossed into the next group.
            elif (step_name and self._group_index < len(cycles) - 1
                  and step_name == self._last_step_name
                  and self._step_started_at is not None):
                next_gi = self._group_index + 1
                next_step_names = {s.get('name') for s in cycles[next_gi].get('steps', [])}
                if step_name in next_step_names:
                    cur_step_dur = next(
                        (s.get('duration', 0) for s in cycles[self._group_index].get('steps', [])
                         if s.get('name') == step_name),
                        None,
                    )
                    if (cur_step_dur is not None
                            and time.monotonic() - self._step_started_at > cur_step_dur):
                        self._group_index = next_gi
                        self._step_started_at = None  # wait for next holding phase

            # Track holding phase start time.  _step_started_at is only set when the
            # device is actually holding at temperature (job="holding"), so condition D
            # and progressInStep are gated on real step-timer time, not ramp time.
            if step_name != self._last_step_name:
                self._last_step_name = step_name
                self._step_started_at = time.monotonic() if is_holding else None
            elif is_holding and self._step_started_at is None:
                # Ramp just finished for this step — holding phase begins.
                self._step_started_at = time.monotonic()

    def get_status(self):
        with self._lock:
            raw = self._device_status
            if raw is None:
                return {'state': 'offline', 'authRequired': bool(OPERATOR_PASSWORD)}
            job = raw.get('job', '').lower()
            # Job-based detection (s=stopped & t=Heating is a startup transitional state)
            # only applies when we know a program is running; avoids treating post-stop
            # Cooling as still-running after _run_state.clear() sets program_id=None.
            # Use startswith to handle variants like "Heating Lid".
            device_running = raw.get('state') in ('running', 'lidwait') or (
                self.program_id is not None
                and job.startswith(('heating', 'cooling', 'holding'))
            )
            status = {
                'state': 'running' if device_running else raw.get('state', 'stopped'),
                'authRequired': bool(OPERATOR_PASSWORD),
                'blockTempC': raw.get('blocktemp'),
                'lidTempC': raw.get('lidtemp'),
                'elapsedSec': raw.get('elapsedsecs'),
                'remainingSec': raw.get('secsleft'),
            }
            if device_running and self.program_id:
                gi = self._group_index
                cycles = (self._program_json or {}).get('cycles', [])
                status['programId'] = self.program_id
                status['cycleGroupIndex'] = gi
                raw_step = raw.get('currentstep', '')
                is_holding = raw.get('job', '').lower() == 'holding'
                status['stepName'] = raw_step  # always the device's current step name
                status['stepHolding'] = is_holding  # false while heating/cooling to temp
                status['cycleIteration'] = raw.get('cycle', 1)
                step_dur = None
                if 0 <= gi < len(cycles):
                    group = cycles[gi]
                    status['cycleLoops'] = group.get('loops', 1)
                    # Only compute step duration when actually holding; progress is
                    # not meaningful while the device is still ramping to temperature.
                    if is_holding:
                        step_dur = next(
                            (s.get('duration') for s in group.get('steps', [])
                             if s.get('name') == raw_step),
                            None,
                        )
                if step_dur and self._step_started_at is not None:
                    elapsed_in_step = time.monotonic() - self._step_started_at
                    status['progressInStep'] = min(1.0, elapsed_in_step / step_dur)
                else:
                    status['progressInStep'] = None
            return status


_run_state = RunState()


# ---------------------------------------------------------------------------
# Device poll thread
# ---------------------------------------------------------------------------

def _auto_detect_running_program(raw):
    """Try to match the device's reported program name to a YAML file."""
    device_name = (raw.get('program') or '').strip()
    if not device_name:
        return
    for yaml_path in PROGRAMS_DIR.glob('*.yaml'):
        try:
            with open(yaml_path, 'r') as f:
                data = yaml.safe_load(f)
            if (data.get('pcr_program_name') or '').strip() == device_name:
                slug = yaml_path.stem
                program_json = yaml_to_json(slug, data)
                _run_state.start(program_json['id'], program_json)
                return
        except Exception:
            pass


def _poll_device():
    while True:
        try:
            path = _find_device_path()
            if path:
                raw = OpenPCR(devicepath=path).readstatus()
                if raw and raw.get('state') in ('running', 'lidwait') and not _run_state.program_id:
                    _auto_detect_running_program(raw)
                # Skip update when STATUS.TXT is blank — the device is mid-rewrite
                # (e.g. transitioning between job states).  Keep the last known state.
                if raw:
                    _run_state.update(raw)
            else:
                _run_state.update(None)
        except Exception:
            _run_state.update(None)
        time.sleep(2.0)


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def end_headers(self):
        # Vendor assets are large and version-pinned — let browsers cache them freely.
        # All other files (HTML, JSX) must be revalidated on every request so that
        # updates are picked up immediately; the server can still respond with 304.
        if not self.path.startswith('/vendor/'):
            self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):
        print(f'  {self.address_string()} {fmt % args}')

    def log_error(self, fmt, *args):
        msg = fmt % args
        if 'Bad request version' not in msg:
            print(f'  ERROR {self.address_string()} {msg}', file=sys.stderr)

    def handle_error(self, request, client_address):
        pass

    # Route dispatch -------------------------------------------------------

    def do_GET(self):
        if self.path == '/programs':
            self._list_programs()
        elif m := re.match(r'^/programs/([^/?]+)$', self.path):
            self._get_program(m.group(1))
        elif self.path == '/templates':
            self._list_templates()
        elif self.path == '/status':
            self._get_status()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/programs':
            self._create_program()
        elif self.path == '/auth/login':
            self._auth_login()
        elif self.path == '/auth/logout':
            self._auth_logout()
        elif self.path == '/run/start':
            self._run_start()
        elif self.path == '/run/stop':
            self._run_stop()
        elif self.path == '/system/shutdown':
            self._shutdown_device()
        elif m := re.match(r'^/programs/([^/?]+)/template$', self.path):
            self._save_as_template(m.group(1))
        else:
            self._error(404, 'Not found')

    def do_PATCH(self):
        if m := re.match(r'^/programs/([^/?]+)$', self.path):
            self._update_program(m.group(1))
        else:
            self._error(404, 'Not found')

    def do_DELETE(self):
        if m := re.match(r'^/programs/([^/?]+)$', self.path):
            self._delete_program(m.group(1))
        else:
            self._error(404, 'Not found')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    # Helpers --------------------------------------------------------------

    def _read_json(self):
        n = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(n)) if n else {}

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, message):
        self._send_json({'error': message}, status)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    # Programs -------------------------------------------------------------

    def _list_programs(self):
        programs = []
        for path in sorted(PROGRAMS_DIR.glob('*.yaml')):
            try:
                with open(path, encoding='utf-8') as f:
                    programs.append(yaml_to_json(path.stem, yaml.safe_load(f) or {}))
            except Exception:
                pass
        self._send_json(programs)

    def _get_program(self, slug):
        path = safe_program_path(slug)
        if path is None:
            self._error(400, 'invalid program id')
            return
        if not path.exists():
            self._error(404, 'Program not found')
        else:
            with open(path, encoding='utf-8') as f:
                self._send_json(yaml_to_json(slug, yaml.safe_load(f) or {}))

    # Auth -----------------------------------------------------------------

    def _auth_login(self):
        if not OPERATOR_PASSWORD:
            self._send_json({'token': ''})
            return
        body = self._read_json()
        if body.get('password') != OPERATOR_PASSWORD:
            self._error(401, 'wrong password')
            return
        token = secrets.token_hex(24)
        _sessions.add(token)
        self._send_json({'token': token})

    def _auth_logout(self):
        auth = self.headers.get('Authorization', '')
        token = auth.removeprefix('Bearer ').strip()
        _sessions.discard(token)
        self.send_response(204)
        self._cors()
        self.end_headers()

    # Programs -------------------------------------------------------------

    def _create_program(self):
        if not _require_operator(self):
            return
        body = self._read_json()
        slug = unique_slug(body.get('name', 'program'))
        data = json_to_yaml_fields(body)
        with open(PROGRAMS_DIR / f'{slug}.yaml', 'w', encoding='utf-8') as f:
            yaml.dump(data, f, allow_unicode=True, sort_keys=False)
        self._send_json(yaml_to_json(slug, data), 201)

    def _update_program(self, slug):
        if not _require_operator(self):
            return
        path = safe_program_path(slug)
        if path is None:
            self._error(400, 'invalid program id')
            return
        if not path.exists():
            self._error(404, 'Program not found')
            return
        with open(path, encoding='utf-8') as f:
            existing = yaml.safe_load(f) or {}
        existing.update(json_to_yaml_fields(self._read_json()))
        with open(path, 'w', encoding='utf-8') as f:
            yaml.dump(existing, f, allow_unicode=True, sort_keys=False)
        self._send_json(yaml_to_json(slug, existing))

    def _delete_program(self, slug):
        if not _require_operator(self):
            return
        path = safe_program_path(slug)
        if path is None:
            self._error(400, 'invalid program id')
            return
        if not path.exists():
            self._error(404, 'Program not found')
        else:
            path.unlink()
            self._send_json({'ok': True})

    def _save_as_template(self, slug):
        if not _require_operator(self):
            return
        src = safe_program_path(slug)
        if src is None:
            self._error(400, 'invalid program id')
            return
        if not src.exists():
            self._error(404, 'Program not found')
            return
        with open(src, encoding='utf-8') as f:
            data = yaml.safe_load(f) or {}
        name = data.get('pcr_program_name', slug)
        dest_slug = unique_slug(name, TEMPLATES_DIR)
        with open(TEMPLATES_DIR / f'{dest_slug}.yaml', 'w', encoding='utf-8') as f:
            yaml.dump(data, f, allow_unicode=True, sort_keys=False)
        self._send_json({'id': dest_slug}, 201)

    # Templates ------------------------------------------------------------

    def _list_templates(self):
        templates = []
        for path in sorted(TEMPLATES_DIR.glob('*.yaml')):
            try:
                with open(path, encoding='utf-8') as f:
                    templates.append(yaml_to_json(path.stem, yaml.safe_load(f) or {}))
            except Exception:
                pass
        self._send_json(templates)

    # Run control ----------------------------------------------------------

    def _run_start(self):
        if not _require_operator(self):
            return
        body = self._read_json()
        program_id = body.get('programId')
        if not program_id:
            self._error(400, 'programId is required')
            return
        path = safe_program_path(program_id)
        if path is None:
            self._error(400, 'invalid program id')
            return
        if not path.exists():
            self._error(404, f'Program not found: {program_id}')
            return
        device_path = _find_device_path()
        if not device_path:
            self._error(503, 'Device not connected')
            return
        with open(path, encoding='utf-8') as f:
            yaml_data = yaml.safe_load(f) or {}
        try:
            prog_str = program_to_device_string(yaml_data)
            OpenPCR(devicepath=device_path).sendprogram(prog_str)
        except RuntimeError:
            # sendprogram() may time out polling for confirmation even when the
            # device received the command — STATUS.TXT is often blank while the
            # device rewrites it during startup (e.g. Heating Lid transition).
            # The write already reached the device; proceed and let the
            # background poll detect the actual state within 2 seconds.
            pass
        except Exception as exc:
            self._error(503, f'Device error: {exc}')
            return
        try:
            _run_state.start(program_id, yaml_to_json(program_id, yaml_data))
        except Exception as exc:
            self._error(503, f'State error: {exc}')
            return
        self._send_json({'ok': True})

    def _run_stop(self):
        if not _require_operator(self):
            return
        device_path = _find_device_path()
        if not device_path:
            self._error(503, 'Device not connected')
            return
        try:
            OpenPCR(devicepath=device_path).stop()
        except Exception as exc:
            self._error(503, f'Device error: {exc}')
            return
        _run_state.clear()
        self._send_json({'ok': True})

    def _shutdown_device(self):
        if not _require_operator(self):
            return
        self._send_json({'ok': True})
        def _do_shutdown():
            time.sleep(0.5)
            result = subprocess.run(['sudo', '/sbin/shutdown', '-h', 'now'],
                                    capture_output=True, text=True)
            if result.returncode != 0:
                print(f'shutdown failed (rc={result.returncode}): {result.stderr.strip()}',
                      file=sys.stderr, flush=True)
        threading.Thread(target=_do_shutdown, daemon=True).start()

    def _get_status(self):
        self._send_json(_run_state.get_status())


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

threading.Thread(target=_poll_device, daemon=True).start()

auth_note = f' (operator password set)' if OPERATOR_PASSWORD else ' (no auth — all actions open)'
try:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as _s:
        _s.connect(('8.8.8.8', 80))
        _ip = _s.getsockname()[0]
except OSError:
    _ip = 'localhost'
print(f'OpenPCR web interface → http://{_ip}:{PORT}/mobile.html{auth_note}')
print('Press Ctrl-C to stop.\n')
with http.server.ThreadingHTTPServer(('', PORT), Handler) as httpd:
    httpd.serve_forever()
