from flask import request

def search(conn):
    payload = request.json
    query = f"SELECT * FROM items WHERE name = '{payload}'"
    conn.cursor().execute(query)
