# vuln_04 — eval() with tainted input from request.form
from flask import request

def compute():
    expr = request.form.get("expression")
    result = eval(expr)
    return result
