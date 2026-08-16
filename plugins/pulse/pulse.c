#include <stdint.h>
#include <string.h>

/* Language-neutral smoke plugin for bloop:abi@1.0.0.
 * Compile with a WASI 0.2 toolchain and wit-bindgen C bindings generated from wit/abi.wit:
 *   wit-bindgen c ../../wit --world activity-plugin
 *   clang --target=wasm32-wasip2 -o component.wasm pulse.c *_component_type.o
 */

static char last_error[128];

int32_t exports_bloop_abi_activity_initialize(void) {
  last_error[0] = 0;
  return 0;
}

int32_t exports_bloop_abi_activity_on_action(uint8_t *action, uint8_t *payload) {
  (void)action;
  (void)payload;
  return 0;
}

int32_t exports_bloop_abi_activity_on_timer(uint8_t *timer_id) {
  (void)timer_id;
  return 0;
}

int32_t exports_bloop_abi_activity_on_event(uint8_t *topic, uint8_t *payload) {
  (void)topic;
  (void)payload;
  return 0;
}

int32_t exports_bloop_abi_activity_on_settings_changed(void) {
  return 0;
}

void exports_bloop_abi_activity_shutdown(void) {}
