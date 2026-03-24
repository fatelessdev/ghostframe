pub fn start_scroll_response<R: Runtime>(app: &AppHandle<R>, direction: &str) {
    let state = app.state::<MoveWindowState>();
    let mut tasks = match state.tasks.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let task_key = format!("scroll_{}", direction);
    if tasks.contains_key(&task_key) {
        return;
    }

    let stop_flag: MoveWindowTask = Arc::new(AtomicBool::new(false));
    let flag_clone = stop_flag.clone();
    let dir = direction.to_string();
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        // Emit roughly every 50ms for smooth enough repetitive scrolling
        let interval = Duration::from_millis(50);
        while !flag_clone.load(Ordering::Relaxed) {
            handle_scroll_response_shortcut(&app_handle, dir == "up");
            sleep(interval).await;
        }
    });

    tasks.insert(task_key, stop_flag);
}

pub fn stop_scroll_response<R: Runtime>(app: &AppHandle<R>, direction: &str) {
    let state = app.state::<MoveWindowState>();
    let mut tasks = match state.tasks.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let task_key = format!("scroll_{}", direction);
    if let Some(flag) = tasks.remove(&task_key) {
        flag.store(true, Ordering::Relaxed);
    }
}
