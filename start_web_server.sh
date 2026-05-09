#!/bin/bash
   # Start a new tmux session named 'web_server' and run the script
   # The -d option will detach the session from the terminal, so that it runs in the background; that
   # isn't necessary if developing the software, but is useful for running it as a service
   # The -s option specifies the session name
   # `set -a` marks all variables that are subsequently defined or modified to be automatically exported to the
   # environment of child processes. Without it, variables defined via `source` are only shell variables,
   # not environment variables.
   cd "${HOME}"/openpcr-web || exit
   set -a && source "${HOME}"/.env && set +a && tmux new-session -d -s web_server "source $(pwd)/.venv/bin/activate && python $(pwd)/web/serve.py --operator-password $SERVER_PASSWORD"
