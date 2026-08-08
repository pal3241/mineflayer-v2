from core.message import (
    Message,
    MessageStatus,
    MessageType,
    MessageValidationError,
)


def test_message_defaults():
    msg = Message(sender="a", recipient="b", type=MessageType.NOTIFICATION)
    assert msg.task_id is None
    assert msg.correlation_id is None
    assert msg.status == MessageStatus.PENDING
    assert msg.id
    assert msg.timestamp is not None


def test_message_types_values():
    assert MessageType.REQUEST.value == "request"
    assert MessageType.RESPONSE.value == "response"
    assert MessageType.NOTIFICATION.value == "notification"
    assert MessageType.ERROR.value == "error"
    assert MessageType.BROADCAST.value == "broadcast"


def test_validation_requires_sender():
    try:
        Message(sender="", recipient="b", type=MessageType.NOTIFICATION).validate()
    except MessageValidationError:
        return
    raise AssertionError("Harus menolak message tanpa sender")


def test_validation_requires_recipient():
    try:
        Message(sender="a", recipient="", type=MessageType.NOTIFICATION).validate()
    except MessageValidationError:
        return
    raise AssertionError("Harus menolak message tanpa recipient")


def test_validation_rejects_bad_type():
    try:
        Message(sender="a", recipient="b", type="acak").validate()
    except MessageValidationError:
        return
    raise AssertionError("Harus menolak message jenis string acak")


def test_valid_message_passes():
    msg = Message(sender="a", recipient="b", type=MessageType.REQUEST, content="x")
    msg.validate()  # tidak melempar
