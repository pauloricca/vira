#[test]
fn patch_decimals_survive_the_host_json_round_trip_exactly() {
    // Patch capture compares the returned document exactly, including positions
    // produced by dragging nodes and values produced by tweaking controls.
    for decimal in [
        "431.18000000000006",
        "159.57999999999998",
        "0.9400000000000001",
        "1.3065629648763766",
    ] {
        let expected: f64 = decimal.parse().unwrap();
        let document = format!(
            r#"{{"nodes":[{{"params":{{"mix":{decimal}}},"position":{{"x":{decimal},"y":80}}}}],"links":[]}}"#
        );
        let parsed: serde_json::Value = serde_json::from_str(&document).unwrap();
        let reply = serde_json::to_string(&parsed).unwrap();
        let returned: serde_json::Value = serde_json::from_str(&reply).unwrap();
        assert_eq!(
            returned["nodes"][0]["position"]["x"]
                .as_f64()
                .unwrap()
                .to_bits(),
            expected.to_bits(),
            "position {decimal}"
        );
        assert_eq!(
            returned["nodes"][0]["params"]["mix"]
                .as_f64()
                .unwrap()
                .to_bits(),
            expected.to_bits(),
            "parameter {decimal}"
        );
    }
}
