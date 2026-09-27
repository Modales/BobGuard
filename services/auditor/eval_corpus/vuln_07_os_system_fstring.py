# vuln_07 — os.system with f-string containing tainted form input
import os
from flask import request

def convert_file():
    filename = request.form.get("filename")
    os.system(f"convert {filename} output.png")
