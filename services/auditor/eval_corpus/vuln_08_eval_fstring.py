# vuln_08 — eval() with f-string containing tainted request.args input
from flask import request

def dynamic_eval():
    val = request.args.get("val")
    eval(f"print({val})")
