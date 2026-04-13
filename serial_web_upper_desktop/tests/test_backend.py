import time

from app import EventHub, SerialManager, parse_hex_string


def wait_until(fn, timeout=2.5, step=0.05):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if fn():
            return True
        time.sleep(step)
    return False


def test_parse_hex_string_ok():
    assert parse_hex_string("AA EE F0") == bytes.fromhex("AA EE F0")
    assert parse_hex_string("0xAA,0x01,02") == bytes.fromhex("AA 01 02")
    assert parse_hex_string("A") == bytes.fromhex("0A")


def test_parse_hex_string_invalid():
    try:
        parse_hex_string("GG")
        assert False, "should raise"
    except ValueError:
        assert True


def test_loop_port_scan_and_scheduler():
    hub = EventHub()
    manager = SerialManager(hub)

    port = "loop://"
    manager.connect_ports([port], baud=115200, timeout=0.1, auto_reconnect=True)

    assert wait_until(lambda: port in manager.connected_ports(), timeout=3.0), "loop:// did not connect"

    result = manager.scan_ports([port], wait_ms=300)
    assert port in result["scanned"]
    assert port in result["found"]

    manager.start_scheduler(bytes.fromhex("AA 55"), interval_ms=80, ports=[port], target="selected")
    time.sleep(0.35)
    manager.stop_scheduler()

    st = manager.states[port]
    assert st.tx_total > 0
    assert st.rx_total > 0

    manager.disconnect_ports([port])


def test_port_logs_recording():
    hub = EventHub()
    manager = SerialManager(hub)

    manager.on_open("COMX", "open ok")
    manager.on_tx("COMX", bytes.fromhex("AA 55"))
    manager.on_rx("COMX", bytes.fromhex("10 20"))
    manager.on_error("COMX", "mock error")
    manager.on_close("COMX", "close")

    logs = manager.get_logs(port="COMX", limit=50, encoding="utf-8")
    assert len(logs) >= 5
    assert any(x["event"] == "tx" and x["direction"] == "TX" for x in logs)
    assert any(x["event"] == "rx" and x["direction"] == "RX" for x in logs)
    assert any(x["text"] == "\x10 " for x in logs if x["event"] == "rx")

    rx_logs = manager.get_logs(port="COMX", direction="RX", limit=50, encoding="utf-8")
    assert len(rx_logs) == 1
    assert rx_logs[0]["event"] == "rx"

    csv_text = manager.export_logs_csv(port="COMX")
    assert "time,port,event,direction,size,hex,text,decode_error,message" in csv_text
    assert "COMX" in csv_text
