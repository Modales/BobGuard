# safe_06 — request.json read but only used with a parameterized query
from flask import request

def insert_event(cursor):
    payload = request.json
    event_type = payload.get("type", "unknown")
    cursor.execute("INSERT INTO events (type) VALUES (?)", (event_type,))
