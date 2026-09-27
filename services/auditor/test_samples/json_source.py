from flask import request

def get_data(conn):
    payload = request.json
    query = f"SELECT * FROM users WHERE data = {payload}"
    conn.cursor().execute(query)
