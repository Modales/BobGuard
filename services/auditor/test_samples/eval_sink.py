from flask import request

def run_expr():
    expr = request.args.get("expr")
    eval(expr)
