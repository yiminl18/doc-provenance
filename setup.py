from setuptools import setup, find_packages

setup(
    name="doc_provenance",  # Replace with your library name
    version="0.1.0",  # Initial version
    author="Yiming Lin",
    author_email="yiminglin@berkeley.edu",
    description="A tool that returns top-k provenance to the question answering over documents.",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    url="https://github.com/yiminl18/doc-provenance.git",  # Repository URL
    packages=find_packages(),  # Automatically find packages in your project
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires=">=3.6",  # Minimum Python version
    install_requires=[
        "pdfminer",
        "tiktoken",
        "sklearn",
        "pandas",
        "openai",
        "numpy"
    ],
)
