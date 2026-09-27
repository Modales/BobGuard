import os
from flask import request

def run_cmd():
    cmd = request.args.get("cmd")
    os.system(cmd)
