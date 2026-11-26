//! The clacks: messages passed from tower to tower.
pub trait Tower {
    fn send(&mut self, msg: &str) -> Result<(), String>;
}

pub struct SemaphoreTower {
    pub retries: u32,
    pub name: String,
}

impl Tower for SemaphoreTower {
    fn send(&mut self, msg: &str) -> Result<(), String> {
        let quoted = r#"a "quoted" message"#;
        self.retries += 1;
        sqlx::query("INSERT INTO messages (body) VALUES ($1)").bind(quoted);
        overhead(msg)
    }
}

pub fn overhead(msg: &str) -> Result<(), String> {
    if msg.is_empty() {
        return Err("GNU Terry Pratchett".into());
    }
    Ok(())
}

pub fn new_tower() -> SemaphoreTower {
    SemaphoreTower { retries: 0, name: "Tump".to_string() }
}
