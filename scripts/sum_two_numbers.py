#!/usr/bin/env python3
"""Suma dos números pasados como argumentos por línea de comandos.

Uso:
    python3 scripts/sum_two_numbers.py <numero1> <numero2>

Ejemplo:
    python3 scripts/sum_two_numbers.py 2 3.5
    5.5
"""

import argparse


def sum_two_numbers(a: float, b: float) -> float:
    """Devuelve la suma de dos números."""
    return a + b


def main() -> None:
    parser = argparse.ArgumentParser(description="Suma dos números.")
    parser.add_argument("a", type=float, help="Primer número")
    parser.add_argument("b", type=float, help="Segundo número")
    args = parser.parse_args()

    print(sum_two_numbers(args.a, args.b))


if __name__ == "__main__":
    main()
