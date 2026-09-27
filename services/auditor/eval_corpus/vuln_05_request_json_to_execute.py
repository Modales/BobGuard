# vuln_05 — request.json flowing into cursor.execute() via f-string
from flask import request

def create_record(cursor):
    data = request.json
    cursor.execute(f"INSERT INTO logs (msg) VALUES ('{data}')")
