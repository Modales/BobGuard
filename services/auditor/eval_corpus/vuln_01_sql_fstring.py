# vuln_01 — SQL injection via f-string in .execute()
# Pattern: request.args.get() → f-string → cursor.execute()
from flask import request

def get_user(cursor):
    user_id = request.args.get("id")
    cursor.execute(f"SELECT * FROM users WHERE id = '{user_id}'")
