# HUKM v1.6.9 — Emergency Stop / Disconnect Reliability

## Changes

- Controller records a cancellation event immediately after claiming a command and before awaiting the asynchronous 'started' network acknowledgement.
- A cancel arriving **before** that event exists is remembered (bounded at 256 IDs) so the queued action cannot unexpectedly run.
- Emergency Pause immediately sets cancellation signals for both active and queued OS actions.
- Each WebSocket connection has a generation number. A command whose ACK overlaps a disconnect or reconnection is invalidated before Windows execution starts.
- When a session disconnects, all current input-worker actions are signaled to stop; queued actions check cancellation before touching Windows.
- When Stop arrives after an irreversible mouse/keyboard/WhatsApp action may already have happened, the result reports **INTERRUPTED_UNVERIFIED**, never success or a safe-to-retry guarantee.
- No automatic re-execution of a command ID; existing persistent dedupe and relay approval gate remain in effect.
- Tests cover early Cancel during ACK, Pause during Start, disconnect between ACK and execution, cancellation after an action may have been delivered, and cancellation signals for queued work.

## Limitations

Python Windows UI Automation can be blocked inside a third-party application call. Cancelling a threading Event cannot undo an already completed OS click, nor always interrupt a native UIA call. To avoid duplicate WhatsApp sends or other high-impact consequences, HUKM reports uncertain completion explicitly and **never automatically retries uncertain actions**.

Full real Windows/laptop behavior, Personal WhatsApp Desktop UI compatibility, Roman Urdu voice accuracy, official Email and Calendar APIs, file/asset generation, cloud Render backend reachability and independent app outcome verification remain separate acceptance items. Actual laptop testing is deferred as requested.

## Release checks

GitHub Actions on `main` runs production dependency audit, TypeScript/React/relay tests, simulated Windows Python tests, frozen EXE smoke tests, package version consistency and SHA-256 installer checksum generation. CI success is not a real device or personal account acceptance result.

The GitHub repository was found to be public during this audit. Repository privacy changes should be assessed against hosting, GitHub Pages and deployment credentials, rather than silently changing visibility or exposing secrets.
