# vuln_02 — SQL injection via assigned variable passed to .execute()
# Pattern: request.args.get() → variable → cursor.execute(variable)
from flask import request

def search(cursor):
    name = request.args.get("name")
    query = f"SELECT * FROM products WHERE name = '{name}'"
    cursor.execute(query)
