from taint_scan import scan_file

print(scan_file("test_samples/vulnerable.py"))
print(scan_file("test_samples/safe.py"))
print("False positive check:")
print(scan_file("test_samples/false_positive.py"))