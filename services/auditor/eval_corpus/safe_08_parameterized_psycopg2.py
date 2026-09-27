# safe_08 — parameterized query using %s placeholder (psycopg2 style)
from flask import request

def find_product(cursor):
    category = request.form.get("category")
    cursor.execute("SELECT * FROM products WHERE category = %s", (category,))
    return cursor.fetchall()
