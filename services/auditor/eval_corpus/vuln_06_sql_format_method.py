# vuln_06 — SQL injection via .format() in .execute()
from flask import request

def lookup(cursor):
    username = request.args.get("user")
    cursor.execute("SELECT * FROM accounts WHERE username = '{}'".format(username))
