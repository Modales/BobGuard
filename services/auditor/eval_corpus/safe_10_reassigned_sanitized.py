# safe_10 — tainted variable reassigned to sanitized value before use
from flask import request

def escape(value):
    import html
    return html.escape(str(value))

def update_record(cursor):
    raw_name = request.args.get("name")
    raw_name = escape(raw_name)   # variable overwritten with sanitized value
    cursor.execute("UPDATE users SET name = ? WHERE active = 1", (raw_name,))
