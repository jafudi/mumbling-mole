#!/bin/bash
set -e

echo The password is "${GUACPWD}"

websockify --ssl-target --web=/home/node/dist 8081 "$MUMBLE_SERVER"
