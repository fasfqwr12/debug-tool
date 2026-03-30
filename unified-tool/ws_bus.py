"""
Clean recovery draft for `ws_bus.py`.

This module is small enough to recover directly from bytecode with high
confidence.
"""

from __future__ import annotations

import asyncio
import json

from core.utils.logger import logger


_ws_clients = set()
_ws_subscriptions = {}
_ws_loop = None
_ws_queue = None
_ws_drop_count = 0
WS_QUEUE_MAXSIZE = 512


async def ws_handler(websocket, path=None):
    _ws_clients.add(websocket)
    _ws_subscriptions[websocket] = set()
    logger.info(f"WebSocket客户端连接, 当前连接数: {len(_ws_clients)}")

    try:
        await websocket.send(json.dumps({"type": "hello", "data": {"version": 1}}, ensure_ascii=False))
    except Exception as e:
        logger.debug(f"WebSocket发送hello失败: {e}")

    try:
        async for message in websocket:
            try:
                payload = json.loads(message)
                if payload.get("type") != "subscribe":
                    continue
                topics = payload.get("topics") or []
                if not isinstance(topics, list):
                    continue
                _ws_subscriptions[websocket] = set([t for t in topics if isinstance(t, str)])
                try:
                    await websocket.send(
                        json.dumps(
                            {"type": "subscribed", "data": {"topics": list(_ws_subscriptions[websocket])}},
                            ensure_ascii=False,
                        )
                    )
                except Exception as e:
                    logger.debug(f"WebSocket发送subscribed失败: {e}")
            except Exception:
                pass
    except Exception:
        pass
    finally:
        _ws_clients.discard(websocket)
        _ws_subscriptions.pop(websocket, None)
        logger.info(f"WebSocket客户端断开, 当前连接数: {len(_ws_clients)}")


def init_ws(loop: asyncio.AbstractEventLoop):
    global _ws_loop, _ws_queue
    _ws_loop = loop
    _ws_queue = asyncio.Queue(maxsize=WS_QUEUE_MAXSIZE)


def _enqueue_broadcast(event_type: str, message: str):
    global _ws_drop_count

    if _ws_queue is None:
        return

    dropped = 0
    while _ws_queue.full():
        try:
            _ws_queue.get_nowait()
            dropped += 1
        except asyncio.QueueEmpty:
            break

    try:
        _ws_queue.put_nowait((event_type, message))
    except asyncio.QueueFull:
        dropped += 1

    if dropped > 0:
        _ws_drop_count += dropped
        if _ws_drop_count == dropped or _ws_drop_count % 50 == 0:
            logger.warning(
                f"WebSocket广播队列拥塞，已累计丢弃 {_ws_drop_count} 条消息 "
                f"(queue={_ws_queue.qsize()}/{WS_QUEUE_MAXSIZE}, latest={event_type})"
            )


async def broadcast_worker():
    while True:
        event_type, message = await _ws_queue.get()
        for client in list(_ws_clients):
            try:
                topics = _ws_subscriptions.get(client, set())
                if event_type not in topics:
                    continue
                await client.send(message)
                logger.info(f"[WS] 已推送 {event_type} 给客户端")
            except Exception as e:
                _ws_clients.discard(client)
                _ws_subscriptions.pop(client, None)
                logger.debug(f"WebSocket发送失败: {e}")


def ws_broadcast(event_type: str, data: dict):
    if _ws_loop is None or _ws_queue is None:
        return

    message = json.dumps({"type": event_type, "data": data}, ensure_ascii=False)
    try:
        _ws_loop.call_soon_threadsafe(_enqueue_broadcast, event_type, message)
    except Exception as e:
        logger.debug(f"WebSocket广播入队失败: {e}")
