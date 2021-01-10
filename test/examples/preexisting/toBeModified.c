// Here is a file with a pre-existing goto. Modifying the stuff around the
// goto should not trigger a warning.
// Adding a new goto, however, should trigger a warning.
int main() {
  int i = 0;
  label:
  i++;
  if (i<5) {
    goto label;
  }
  return i;
}
