#!/bin/bash
# basic reference for writing script for travis

set -ev

cd /home

mkdir -p /workspace/tmp
mkdir -p /workspace/out

node test_1.js > /workspace/out/1.log
node test_2.js > /workspace/out/2.log
