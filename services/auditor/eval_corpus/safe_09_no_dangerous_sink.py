# safe_09 — user input logged only (no dangerous sink)
from flask import request
import logging

logger = logging.getLogger(__name__)

def log_request():
    user_agent = request.headers.get("User-Agent")
    logger.info("Request from: %s", user_agent)
