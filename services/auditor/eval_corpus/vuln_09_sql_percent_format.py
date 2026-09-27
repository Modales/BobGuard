# vuln_09 — SQL injection via % string formatting in .execute()
from flask import request

def delete_record(cursor):
    record_id = request.args.get("record_id")
    cursor.execute("DELETE FROM records WHERE id = %s" % record_id)
