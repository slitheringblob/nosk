"""Outgoing email. The console backend logs messages instead of sending them (dev default)."""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger("nosk.email")
# Recent messages, inspected by tests and handy when developing without an SMTP server.
outbox: list[EmailMessage] = []
OUTBOX_LIMIT = 50


def _deliver_smtp(message: EmailMessage) -> None:
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
        if settings.smtp_use_tls:
            client.starttls()
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password or "")
        client.send_message(message)


async def send_email(to: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = settings.smtp_sender
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    outbox.append(message)
    del outbox[:-OUTBOX_LIMIT]
    if settings.email_backend == "smtp":
        try:
            await asyncio.to_thread(_deliver_smtp, message)
        except (OSError, smtplib.SMTPException):
            logger.exception("Failed to send email to %s", to)
    else:
        logger.warning("Email to %s | %s\n%s", to, subject, body)


async def send_verification_email(to: str, token: str) -> None:
    link = f"{settings.primary_frontend_origin}/login.html?verify={token}"
    await send_email(
        to,
        "Verify your nosk email",
        f"Welcome to nosk!\n\nConfirm your email address by opening this link:\n{link}\n\n"
        f"The link expires in {settings.verify_token_expire_minutes // 60} hours.",
    )


async def send_password_reset_email(to: str, token: str) -> None:
    link = f"{settings.primary_frontend_origin}/login.html?reset={token}"
    await send_email(
        to,
        "Reset your nosk password",
        f"Someone asked to reset the password for this account.\n\nReset it here:\n{link}\n\n"
        f"The link expires in {settings.reset_token_expire_minutes} minutes. If you didn't ask "
        "for this, you can ignore this email.",
    )
