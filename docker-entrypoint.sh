#!/bin/bash
set -e

echo Doing awsome stuff

websockify --ssl-target --web=/home/node/dist 8081 "$MUMBLE_SERVER"
