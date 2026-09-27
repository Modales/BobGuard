from flask import request

def get_user_assigned(conn):
    user_id = request.args.get("id")
    query = f"SELECT * FROM users WHERE id = {user_id}"
    result = conn.cursor().execute(query)
    return result
