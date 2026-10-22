import Paw "../backend/lib/Paw";
import Json "mo:json";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Text "mo:core/Text";

let good = "{\"ok\": true, \"result\": {\"order_id\":\"0123456789abcdef01234567\", \"extra\":\"bonsai-1\", \"fiat_currency\":\"EUR\", \"initial_fiat_amount\":50.00, \"billing_type\":\"STATIC\", \"status\":\"success\", \"payment_url\":\"https://pay.pawpayments.com/checkout/test\"}}";
let #ok invoice = Paw.parse(good) else { assert false; loop {} };
assert invoice.amount == 50;
assert invoice.status == "success";
assert invoice.url == ?"https://pay.pawpayments.com/checkout/test";
assert invoice.sandbox == null;
assert Paw.environmentMatches(invoice, true) and Paw.environmentMatches(invoice, false);
assert not Paw.environmentMatches({ invoice with sandbox = ?true }, false);
assert Paw.parse(Paw.canonical(invoice)) == #ok({ invoice with url = null });
assert Paw.paid("success") and Paw.paid("paid_over");
for (status in ["created", "confirming", "partially_paid", "high_risk", "failed", "cancelled", "expired", "refunded", "unknown"].values()) {
  assert not Paw.paid(status);
};
assert not Paw.known("unknown");
assert Paw.known("partially_paid");
assert not Paw.terminal("partially_paid");
assert Paw.validUrl("https://pay.pawpayments.com/checkout/abc");
assert not Paw.validUrl("https://pay.pawpayments.com.evil.test/checkout/abc");
assert not Paw.validUrl("javascript:alert(1)");
assert not Paw.validUrl("http://pay.pawpayments.com/checkout/abc");
for (body in ["", "not json", "{\"ok\":false}", "{\"ok\":true}", "{\"ok\":true,\"result\":{}}"].values()) {
  switch (Paw.parse(body)) { case (#err _) {}; case _ assert false };
};
let #ok parsedBody = Json.parse(Paw.createBody("bonsai-1", 50, "usdc_eth", "https://example.test")) else { assert false; loop {} };
assert Paw.text(parsedBody, "billing_type") == ?"STATIC";
assert Paw.text(parsedBody, "amount") == ?"50.00";
assert Paw.text(parsedBody, "asset") == ?"usdc_eth";
assert Paw.text(parsedBody, "on_paid_url") == ?"https://example.test/mint";
let #ok escaped = Json.parse("{\"message\":\"quoted \\\"string\\\"\",\"amount\":\"50.00\"}") else { assert false; loop {} };
assert Paw.text(escaped, "message") == ?"quoted \"string\"";
assert Paw.decimal(escaped, "amount") == ?50;
