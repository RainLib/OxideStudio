use anyhow::{ensure, Context, Result};
use sha2::{Digest, Sha256};

const MAGIC: &[u8; 4] = b"OXM\x01";
const MAX_COLUMNS: usize = 512;

// Source values have already passed the server-side row guard. Each cell holds
// native UTF-8 scalar text, binary float bits, bytes, or SRID-prefixed geometry.
pub(super) fn encode(cells: &[Option<Vec<u8>>], budget: usize) -> Result<Vec<u8>> {
    ensure!(
        !cells.is_empty() && cells.len() <= MAX_COLUMNS,
        "invalid MySQL snapshot column count"
    );
    let mut size = 6_usize;
    for cell in cells {
        size = size
            .checked_add(4)
            .and_then(|size| size.checked_add(cell.as_ref().map_or(0, Vec::len)))
            .context("MySQL snapshot row size overflow")?;
    }
    ensure!(
        size <= budget && size <= u32::MAX as usize,
        "MySQL snapshot row exceeds its budget"
    );
    let mut wire = Vec::with_capacity(size);
    wire.extend_from_slice(MAGIC);
    wire.extend_from_slice(&(cells.len() as u16).to_le_bytes());
    for cell in cells {
        match cell {
            None => wire.extend_from_slice(&u32::MAX.to_le_bytes()),
            Some(value) => {
                wire.extend_from_slice(&(value.len() as u32).to_le_bytes());
                wire.extend_from_slice(value);
            }
        }
    }
    Ok(wire)
}

pub(super) fn decode(wire: &[u8], columns: usize, budget: usize) -> Result<Vec<Option<Vec<u8>>>> {
    ensure!(
        wire.len() <= budget && wire.len() >= 6 && wire.get(..4) == Some(MAGIC),
        "invalid MySQL snapshot frame or budget"
    );
    let count = usize::from(u16::from_le_bytes(wire[4..6].try_into()?));
    ensure!(
        count == columns && count > 0 && count <= MAX_COLUMNS,
        "MySQL snapshot column mapping changed"
    );
    let mut cells = Vec::with_capacity(count);
    let mut offset = 6_usize;
    for _ in 0..count {
        let end = offset
            .checked_add(4)
            .context("MySQL snapshot cursor overflow")?;
        let len = u32::from_le_bytes(
            wire.get(offset..end)
                .context("truncated MySQL snapshot length")?
                .try_into()?,
        );
        offset = end;
        if len == u32::MAX {
            cells.push(None);
        } else {
            let end = offset
                .checked_add(len as usize)
                .context("MySQL snapshot payload overflow")?;
            cells.push(Some(
                wire.get(offset..end)
                    .context("truncated MySQL snapshot cell")?
                    .to_vec(),
            ));
            offset = end;
        }
    }
    ensure!(
        offset == wire.len(),
        "MySQL snapshot frame has trailing data"
    );
    Ok(cells)
}

pub(super) fn float_bytes(value: f64) -> Result<Vec<u8>> {
    ensure!(
        value.is_finite(),
        "MySQL transfer cannot encode a nonfinite floating-point value"
    );
    Ok(value.to_bits().to_le_bytes().to_vec())
}

pub(super) fn float_value(bytes: &[u8]) -> Result<f64> {
    let value = f64::from_bits(u64::from_le_bytes(
        bytes
            .try_into()
            .context("invalid MySQL floating-point frame")?,
    ));
    ensure!(
        value.is_finite(),
        "MySQL transfer cannot decode a nonfinite floating-point value"
    );
    Ok(value)
}

pub(super) fn stage_hasher() -> Sha256 {
    let mut digest = Sha256::new();
    digest.update(b"oxide-mysql-staged-rows-v3\0");
    digest
}

pub(super) fn hash_row(digest: &mut Sha256, sequence: u64, wire: &[u8]) -> Result<()> {
    let length = u32::try_from(wire.len()).context("MySQL receipt frame exceeds its budget")?;
    digest.update(sequence.to_be_bytes());
    digest.update(length.to_le_bytes());
    digest.update(wire);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_preserve_null_empty_unicode_binary_and_geometry() -> Result<()> {
        let cells = vec![
            None,
            Some(vec![]),
            Some("line\n\t\0中文".as_bytes().to_vec()),
            Some(vec![0, 255, 1]),
            Some(vec![0, 0, 16, 230, 1, 2, 3]),
        ];
        let wire = encode(&cells, 1024)?;
        assert_eq!(decode(&wire, cells.len(), 1024)?, cells);
        for end in 0..wire.len() {
            assert!(decode(&wire[..end], cells.len(), 1024).is_err());
        }
        assert!(decode(&wire, cells.len() + 1, 1024).is_err());
        assert!(decode(&wire, cells.len(), wire.len() - 1).is_err());
        let mut extra = wire.clone();
        extra.push(0);
        assert!(decode(&extra, cells.len(), 1024).is_err());
        let mut version = wire.clone();
        version[3] = 2;
        assert!(decode(&version, cells.len(), 1024).is_err());
        assert!(encode(&[], 1024).is_err());
        assert!(encode(&vec![None; 513], 4096).is_err());
        assert!(encode(&cells, wire.len() - 1).is_err());
        Ok(())
    }

    #[test]
    fn ordinal_and_exact_cell_bytes_bind_the_batch_digest() -> Result<()> {
        let row = encode(
            &[Some(b"9007199254740993".to_vec()), Some(vec![0, 255])],
            1024,
        )?;
        let digest = |sequence, wire: &[u8]| -> Result<Vec<u8>> {
            let mut digest = stage_hasher();
            hash_row(&mut digest, sequence, wire)?;
            Ok(digest.finalize().to_vec())
        };
        assert_ne!(digest(1, &row)?, digest(2, &row)?);
        let mut changed = row.clone();
        *changed.last_mut().unwrap() ^= 1;
        assert_ne!(digest(1, &row)?, digest(1, &changed)?);
        for value in [
            -0.0,
            0.10000000000000002,
            f64::MIN_POSITIVE,
            f64::from_bits(1),
            f64::MAX,
        ] {
            let bytes = float_bytes(value)?;
            assert_eq!(bytes.len(), 8);
            assert_eq!(float_value(&bytes)?.to_bits(), value.to_bits());
        }
        assert!(float_value(&[0; 7]).is_err());
        assert!(float_bytes(f64::NAN).is_err());
        assert!(float_bytes(f64::INFINITY).is_err());
        Ok(())
    }
}
