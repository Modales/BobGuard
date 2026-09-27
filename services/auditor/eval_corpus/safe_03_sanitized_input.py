# safe_03 — input sanitized before use in query
from flask import request

def sanitize(value):
    return value.replace("'", "''")

def lookup(cursor):
    raw = request.args.get("name")
    clean = sanitize(raw)
    cursor.execute("SELECT * FROM items WHERE name = ?", (clean,))
