//! 最小の JSON(依存なし)。パース・出力・構造の比較。数値は f64(整数は整数として出力する)。

use std::fmt::Write;

#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    /// 挿入順を保つ(比較は順序に依らない)
    Obj(Vec<(String, Json)>),
}

impl Json {
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(v) => v.iter().find(|(k, _)| k == key).map(|(_, x)| x),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Json::Num(n) => Some(*n),
            _ => None,
        }
    }
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Json::Num(n) => Some(*n as i64),
            _ => None,
        }
    }
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(b) => Some(*b),
            _ => None,
        }
    }
    pub fn as_arr(&self) -> Option<&Vec<Json>> {
        match self {
            Json::Arr(a) => Some(a),
            _ => None,
        }
    }
    pub fn is_null(&self) -> bool {
        matches!(self, Json::Null)
    }
    /// キー集合を返す(オブジェクトでなければ空)
    pub fn keys(&self) -> Vec<&str> {
        match self {
            Json::Obj(v) => v.iter().map(|(k, _)| k.as_str()).collect(),
            _ => vec![],
        }
    }
    pub fn obj(items: Vec<(&str, Json)>) -> Json {
        Json::Obj(items.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }
    pub fn int(n: i64) -> Json {
        Json::Num(n as f64)
    }
    pub fn str(s: &str) -> Json {
        Json::Str(s.to_string())
    }

    /// 構造が等しいか(オブジェクトのキーの順序は無視する)
    pub fn same(&self, other: &Json) -> bool {
        self.diff(other, "").is_none()
    }

    /// 最初に食い違う場所のパスを返す(差分テストのデバッグ用)
    pub fn diff(&self, other: &Json, path: &str) -> Option<String> {
        match (self, other) {
            (Json::Obj(a), Json::Obj(b)) => {
                for (k, v) in a {
                    match b.iter().find(|(k2, _)| k2 == k) {
                        None => return Some(format!("{}/{}: 右に無い(左 {})", path, k, short(v))),
                        Some((_, v2)) => {
                            if let Some(d) = v.diff(v2, &format!("{}/{}", path, k)) {
                                return Some(d);
                            }
                        }
                    }
                }
                for (k, v) in b {
                    if !a.iter().any(|(k2, _)| k2 == k) {
                        return Some(format!("{}/{}: 左に無い(右 {})", path, k, short(v)));
                    }
                }
                None
            }
            (Json::Arr(a), Json::Arr(b)) => {
                if a.len() != b.len() {
                    return Some(format!("{}: 配列の長さ {} と {} (左 {} / 右 {})", path, a.len(), b.len(), short(self), short(other)));
                }
                for (i, (x, y)) in a.iter().zip(b).enumerate() {
                    if let Some(d) = x.diff(y, &format!("{}[{}]", path, i)) {
                        return Some(d);
                    }
                }
                None
            }
            _ => {
                if self == other {
                    None
                } else {
                    Some(format!("{}: {} と {}", path, short(self), short(other)))
                }
            }
        }
    }
}

fn short(j: &Json) -> String {
    let s = j.to_string();
    if s.chars().count() > 160 {
        format!("{}…", s.chars().take(160).collect::<String>())
    } else {
        s
    }
}

impl std::fmt::Display for Json {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut s = String::new();
        write_json(self, &mut s);
        f.write_str(&s)
    }
}

pub fn write_json(j: &Json, out: &mut String) {
    match j {
        Json::Null => out.push_str("null"),
        Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Json::Num(n) => {
            if n.fract() == 0.0 && n.abs() < 9e15 {
                let _ = write!(out, "{}", *n as i64);
            } else {
                let _ = write!(out, "{}", n);
            }
        }
        Json::Str(s) => write_str(s, out),
        Json::Arr(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json(x, out);
            }
            out.push(']');
        }
        Json::Obj(o) => {
            out.push('{');
            for (i, (k, v)) in o.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_str(k, out);
                out.push(':');
                write_json(v, out);
            }
            out.push('}');
        }
    }
}

fn write_str(s: &str, out: &mut String) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

pub fn parse(src: &str) -> Result<Json, String> {
    let b = src.as_bytes();
    let mut p = P { b, i: 0 };
    p.ws();
    let v = p.value()?;
    p.ws();
    if p.i != b.len() {
        return Err(format!("JSON の末尾に余分な文字があります(位置 {})", p.i));
    }
    Ok(v)
}

struct P<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> P<'a> {
    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\n' | b'\r' | b'\t') {
            self.i += 1;
        }
    }
    fn err<T>(&self, m: &str) -> Result<T, String> {
        Err(format!("JSON パースエラー: {}(位置 {})", m, self.i))
    }
    fn value(&mut self) -> Result<Json, String> {
        if self.i >= self.b.len() {
            return self.err("入力が途中で終わっています");
        }
        match self.b[self.i] {
            b'n' => self.lit("null", Json::Null),
            b't' => self.lit("true", Json::Bool(true)),
            b'f' => self.lit("false", Json::Bool(false)),
            b'"' => Ok(Json::Str(self.string()?)),
            b'[' => {
                self.i += 1;
                let mut v = Vec::new();
                self.ws();
                if self.i < self.b.len() && self.b[self.i] == b']' {
                    self.i += 1;
                    return Ok(Json::Arr(v));
                }
                loop {
                    self.ws();
                    v.push(self.value()?);
                    self.ws();
                    match self.b.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b']') => {
                            self.i += 1;
                            return Ok(Json::Arr(v));
                        }
                        _ => return self.err("配列の , か ] が必要です"),
                    }
                }
            }
            b'{' => {
                self.i += 1;
                let mut v = Vec::new();
                self.ws();
                if self.i < self.b.len() && self.b[self.i] == b'}' {
                    self.i += 1;
                    return Ok(Json::Obj(v));
                }
                loop {
                    self.ws();
                    if self.b.get(self.i) != Some(&b'"') {
                        return self.err("キーの文字列が必要です");
                    }
                    let k = self.string()?;
                    self.ws();
                    if self.b.get(self.i) != Some(&b':') {
                        return self.err(": が必要です");
                    }
                    self.i += 1;
                    self.ws();
                    let x = self.value()?;
                    v.push((k, x));
                    self.ws();
                    match self.b.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b'}') => {
                            self.i += 1;
                            return Ok(Json::Obj(v));
                        }
                        _ => return self.err("オブジェクトの , か } が必要です"),
                    }
                }
            }
            _ => self.number(),
        }
    }
    fn lit(&mut self, s: &str, v: Json) -> Result<Json, String> {
        if self.b[self.i..].starts_with(s.as_bytes()) {
            self.i += s.len();
            Ok(v)
        } else {
            self.err("不明な値です")
        }
    }
    fn number(&mut self) -> Result<Json, String> {
        let st = self.i;
        while self.i < self.b.len() && matches!(self.b[self.i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') {
            self.i += 1;
        }
        let s = std::str::from_utf8(&self.b[st..self.i]).unwrap();
        match s.parse::<f64>() {
            Ok(n) => Ok(Json::Num(n)),
            Err(_) => self.err("数値が不正です"),
        }
    }
    fn string(&mut self) -> Result<String, String> {
        self.i += 1; // 開きの "
        let mut out: Vec<u8> = Vec::new();
        loop {
            let c = *self.b.get(self.i).ok_or_else(|| "文字列が閉じていません".to_string())?;
            self.i += 1;
            match c {
                b'"' => break,
                b'\\' => {
                    let e = *self.b.get(self.i).ok_or_else(|| "エスケープが途中です".to_string())?;
                    self.i += 1;
                    match e {
                        b'"' => out.push(b'"'),
                        b'\\' => out.push(b'\\'),
                        b'/' => out.push(b'/'),
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'u' => {
                            let mut cp = self.hex4()?;
                            if (0xD800..0xDC00).contains(&cp) && self.b.get(self.i) == Some(&b'\\') && self.b.get(self.i + 1) == Some(&b'u') {
                                self.i += 2;
                                let lo = self.hex4()?;
                                cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                            }
                            let ch = char::from_u32(cp).unwrap_or('\u{FFFD}');
                            let mut buf = [0u8; 4];
                            out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                        }
                        _ => return self.err("不明なエスケープです"),
                    }
                }
                _ => out.push(c),
            }
        }
        String::from_utf8(out).map_err(|_| "UTF-8 が不正です".to_string())
    }
    fn hex4(&mut self) -> Result<u32, String> {
        if self.i + 4 > self.b.len() {
            return self.err("\\u の桁が足りません");
        }
        let s = std::str::from_utf8(&self.b[self.i..self.i + 4]).map_err(|_| "不正".to_string())?;
        self.i += 4;
        u32::from_str_radix(s, 16).map_err(|_| "\\u が不正です".to_string())
    }
}
