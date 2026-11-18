// Access-code page of the shared DWH Runner. The server keeps only a hash of the code.
"use strict";
const form = document.getElementById("login");
const msg = document.getElementById("msg");
form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  msg.textContent = "";
  try {
    const res = await fetch("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: document.getElementById("code").value }) });
    if (res.ok) return location.reload();
    const j = await res.json().catch(() => null);
    msg.textContent = (j && j.error) || "The code was not accepted.";
  } catch {
    msg.textContent = "The DWH Runner on the host PC does not answer. Is it still running?";
  }
});
