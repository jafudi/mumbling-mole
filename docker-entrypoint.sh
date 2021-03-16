#!/bin/bash
set -e

/sbin/tini -- websockify --ssl-target --web=/home/node/dist 8081 "$MUMBLE_SERVER"
