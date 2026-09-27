# safe_04 — os.system called with a hardcoded string only
import os

def run_cleanup():
    os.system("rm -f /tmp/cache/*.tmp")
