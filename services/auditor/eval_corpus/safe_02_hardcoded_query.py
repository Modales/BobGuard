# safe_02 — hardcoded query, no user input involved
def get_all_users(cursor):
    cursor.execute("SELECT * FROM users")
    return cursor.fetchall()
