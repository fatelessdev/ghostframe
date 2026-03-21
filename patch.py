from pathlib import Path
content = Path("src-tauri/src/lib.rs").read_text(encoding="utf-8")
content = content.replace(
    """                                        if let Some(direction) =
                                              action_id.strip_prefix("move_window_")
                                          {
                                              shortcuts::start_move_window(app, direction);
                                          } else {
                                              eprintln!("Shortcut triggered: {}", action_id);
                                              shortcuts::handle_shortcut_action(app, &action_id);
                                          }""",
    """                                        if let Some(direction) =
                                              action_id.strip_prefix("move_window_")
                                          {
                                              shortcuts::start_move_window(app, direction);
                                          } else if let Some(direction) = action_id.strip_prefix("scroll_response_") {
                                              shortcuts::start_scroll_response(app, direction);
                                          } else {
                                              eprintln!("Shortcut triggered: {}", action_id);
                                              shortcuts::handle_shortcut_action(app, &action_id);
                                          }"""
)
content = content.replace(
    """                                        if let Some(direction) =
                                              action_id.strip_prefix("move_window_")
                                          {
                                              shortcuts::stop_move_window(app, direction);
                                          }""",
    """                                        if let Some(direction) = action_id.strip_prefix("move_window_") {
                                              shortcuts::stop_move_window(app, direction);
                                          } else if let Some(direction) = action_id.strip_prefix("scroll_response_") {
                                              shortcuts::stop_scroll_response(app, direction);
                                          }"""
)
Path("src-tauri/src/lib.rs").write_text(content, encoding="utf-8")
