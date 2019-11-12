#!/bin/bash
# basic reference for writing script for travis

set -ev

cd /home

mkdir -p ./tmp
mkdir -p /workspace/out

node test_1.js > /workspace/out/1.log
node test_2.js > /workspace/out/2.log

apt install -y ffmpeg
ffmpeg -i ./tmp/%d.jpg /workspace/out/2.mp4