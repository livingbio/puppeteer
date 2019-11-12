#!/bin/bash
# basic reference for writing script for travis

set -ev

mkdir -p ./tmp
mkdir -p ./out

node test_1.js > out/1.log
node test_2.js > out/2.log
