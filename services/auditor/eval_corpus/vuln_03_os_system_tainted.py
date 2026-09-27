# vuln_03 — os.system with tainted input from request.args
import os
from flask import request

def run_command():
    cmd = request.args.get("cmd")
    os.system(cmd)
