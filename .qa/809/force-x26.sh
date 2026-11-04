#!/bin/sh
# #809 measurement: what the audit counts if Exit 26 is admitted. Container-only instrumentation.
set -eu
python3 .qa/809/patch-force.py
sh .qa/809/regenerate-gates.sh force ikebukuro
