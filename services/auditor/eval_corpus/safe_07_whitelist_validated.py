# safe_07 — whitelist validation before use in shell command
import os
from flask import request

ALLOWED_ACTIONS = {"start", "stop", "restart"}

def manage_service():
    action = request.args.get("action")
    if action not in ALLOWED_ACTIONS:
        return "invalid"
    os.system(f"systemctl {action} myservice")
