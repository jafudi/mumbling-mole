#!/bin/bash
set -e

websockify --ssl-target --web=/home/node/dist 8081 "$MUMBLE_SERVER"
