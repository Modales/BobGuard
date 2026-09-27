# safe_01 — parameterized query with placeholder, no taint
from flask import request

def get_user(cursor):
    user_id = request.args.get("id")
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
