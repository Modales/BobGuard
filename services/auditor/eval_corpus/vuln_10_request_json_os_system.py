# vuln_10 — request.json flowing directly into os.system()
import os
from flask import request

def run_job():
    payload = request.json
    os.system(f"run_job --input {payload}")
