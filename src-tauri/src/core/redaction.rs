fn redact_url_userinfo(input: &str) -> String {
    let Some(scheme_end) = input.find("://") else {
        return input.to_string();
    };
    let authority_start = scheme_end + 3;
    let authority_end = input[authority_start..]
        .find(['/', '?', '#'])
        .map(|idx| authority_start + idx)
        .unwrap_or(input.len());
    let authority = &input[authority_start..authority_end];
    let Some(at_index) = authority.rfind('@') else {
        return input.to_string();
    };

    let userinfo = &authority[..at_index];
    let Some(password_start) = userinfo.find(':') else {
        return input.to_string();
    };

    format!(
        "{}{}****{}",
        &input[..authority_start + password_start + 1],
        "",
        &input[authority_start + at_index..]
    )
}

fn redact_mysql_tcp_dsn(input: &str) -> String {
    let Some(tcp_index) = input.find("@tcp(") else {
        return input.to_string();
    };
    let userinfo = &input[..tcp_index];
    let Some(password_start) = userinfo.find(':') else {
        return input.to_string();
    };

    format!("{}:****{}", &input[..password_start], &input[tcp_index..])
}

fn redact_secret_query_params(input: &str) -> String {
    let Some(query_start) = input.find('?') else {
        return input.to_string();
    };

    let mut output = String::with_capacity(input.len());
    output.push_str(&input[..=query_start]);

    let mut first = true;
    for part in input[query_start + 1..].split('&') {
        if !first {
            output.push('&');
        }
        first = false;

        let (key, value) = part.split_once('=').unwrap_or((part, ""));
        let lower_key = key.to_ascii_lowercase();
        if matches!(lower_key.as_str(), "password" | "passwd" | "pwd" | "pass") {
            output.push_str(key);
            output.push_str("=****");
        } else {
            output.push_str(key);
            if !value.is_empty() || part.contains('=') {
                output.push('=');
                output.push_str(value);
            }
        }
    }

    output
}

pub fn redact_connection_url(input: &str) -> String {
    let redacted = redact_url_userinfo(input);
    let redacted = redact_mysql_tcp_dsn(&redacted);
    redact_secret_query_params(&redacted)
}

#[cfg(test)]
mod tests {
    use super::redact_connection_url;

    #[test]
    fn redacts_url_passwords() {
        assert_eq!(
            redact_connection_url("postgres://user:secret@localhost:5432/db"),
            "postgres://user:****@localhost:5432/db"
        );
        assert_eq!(
            redact_connection_url("mysql://user:secret@localhost/db?ssl-mode=require"),
            "mysql://user:****@localhost/db?ssl-mode=require"
        );
    }

    #[test]
    fn redacts_mysql_tcp_dsn_and_query_passwords() {
        assert_eq!(
            redact_connection_url("user:secret@tcp(localhost:3306)/db?password=secret&x=1"),
            "user:****@tcp(localhost:3306)/db?password=****&x=1"
        );
    }
}
